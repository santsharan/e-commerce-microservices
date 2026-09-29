import type { AppConfig, ServiceName } from "@commerce-flow/config";
import { AppError, ErrorCode, redactCredentials } from "@commerce-flow/errors";
import type { Logger } from "@commerce-flow/logger";
import { connectKafka, type KafkaHandle } from "@commerce-flow/kafka";
import { connectMongo, type MongoHandle } from "@commerce-flow/mongodb";
import { connectRedis, type RedisHandle } from "@commerce-flow/redis";
import type { ReadinessReport } from "./index.js";
import { recordMongoDuration, shutdownTelemetry } from "./telemetry.js";

export interface DependencyProfile {
  mongo: boolean;
  redis: boolean;
  kafka: boolean;
}

/**
 * Which process must reach which dependency before it serves traffic.
 * The gateway uses Redis for rate limits and idempotency.
 * Catalog uses Redis as a read cache.
 * Identity stores users in MongoDB and does not publish yet.
 * Inventory, orders, payments, and notifications use MongoDB and Kafka.
 */
export function dependencyProfile(serviceName: ServiceName): DependencyProfile {
  switch (serviceName) {
    case "api-gateway":
      return { mongo: false, redis: true, kafka: false };
    case "identity-service":
      return { mongo: true, redis: false, kafka: false };
    case "catalog-service":
      return { mongo: true, redis: true, kafka: false };
    case "inventory-service":
    case "order-service":
    case "payment-service":
    case "notification-service":
      return { mongo: true, redis: false, kafka: true };
    default: {
      const unknown: never = serviceName;
      throw new Error(`Unknown service ${String(unknown)}`);
    }
  }
}

export function readinessFromChecks(checks: Record<string, "ok" | "unavailable">): ReadinessReport {
  const status = Object.values(checks).every((value) => value === "ok") ? "ok" : "unavailable";
  return { status, checks };
}

export interface ServiceDependencies {
  profile: DependencyProfile;
  mongo?: MongoHandle;
  redis?: RedisHandle;
  kafka?: KafkaHandle;
  ping(): Promise<Record<string, "ok" | "unavailable">>;
  close(): Promise<void>;
}

async function probe(
  name: string,
  run: () => Promise<void>,
  logger: Logger,
): Promise<"ok" | "unavailable"> {
  try {
    await run();
    return "ok";
  } catch (error) {
    const message = error instanceof Error ? redactCredentials(error.message) : "unavailable";
    logger.error({
      event: "dependency.unavailable",
      dependency: name,
      message,
    });
    return "unavailable";
  }
}

async function closeQuietly(close: (() => Promise<void>) | undefined): Promise<void> {
  if (close === undefined) {
    return;
  }
  try {
    await close();
  } catch {
    // Shutdown continues so the next client still closes.
  }
}

/**
 * Opens the clients this service is allowed to use.
 * Closes anything already opened when a later client fails.
 * Close order is Kafka, then Redis, then MongoDB, after HTTP has stopped.
 */
export async function openDependencies(
  config: AppConfig,
  logger: Logger,
): Promise<ServiceDependencies> {
  const profile = dependencyProfile(config.serviceName);
  let mongo: MongoHandle | undefined;
  let redis: RedisHandle | undefined;
  let kafka: KafkaHandle | undefined;

  try {
    if (profile.mongo) {
      mongo = await connectMongo({
        uri: config.mongodb.uri,
        database: config.mongodb.database,
        logger,
        onCommand: ({ durationMs, commandName }) => {
          recordMongoDuration(durationMs, commandName);
        },
      });
    }
    if (profile.redis) {
      redis = await connectRedis({ url: config.redis.url, logger });
    }
    if (profile.kafka) {
      kafka = await connectKafka({
        brokers: config.kafka.brokers,
        clientId: config.kafka.clientId,
        logger,
      });
    }
  } catch (error) {
    await closeQuietly(kafka?.close);
    await closeQuietly(redis?.close);
    await closeQuietly(mongo?.close);
    throw error;
  }

  const opened: ServiceDependencies = {
    profile,
    async ping(): Promise<Record<string, "ok" | "unavailable">> {
      const checks: Record<string, "ok" | "unavailable"> = { process: "ok" };
      if (mongo !== undefined) {
        const mongoClient = mongo;
        checks["mongodb"] = await probe("mongodb", () => mongoClient.ping(), logger);
      }
      if (redis !== undefined) {
        const redisClient = redis;
        checks["redis"] = await probe("redis", () => redisClient.ping(), logger);
      }
      if (kafka !== undefined) {
        const kafkaClient = kafka;
        checks["kafka"] = await probe("kafka", () => kafkaClient.ping(), logger);
      }
      return checks;
    },
    async close(): Promise<void> {
      await shutdownTelemetry();
      await closeQuietly(kafka?.close);
      await closeQuietly(redis?.close);
      await closeQuietly(mongo?.close);
    },
  };
  if (mongo !== undefined) {
    opened.mongo = mongo;
  }
  if (redis !== undefined) {
    opened.redis = redis;
  }
  if (kafka !== undefined) {
    opened.kafka = kafka;
  }
  return opened;
}

export async function assertDependenciesReady(
  dependencies: Pick<ServiceDependencies, "ping">,
): Promise<void> {
  const checks = await dependencies.ping();
  const report = readinessFromChecks(checks);
  if (report.status === "ok") {
    return;
  }
  const dependenciesDown = Object.entries(checks)
    .filter(([, status]) => status === "unavailable")
    .map(([name]) => name);
  throw new AppError(
    ErrorCode.DEPENDENCY_UNAVAILABLE,
    "A required dependency is unavailable",
    503,
    {
      dependencies: dependenciesDown,
    },
  );
}
