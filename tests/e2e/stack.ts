import { generateKeyPairSync } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Kafka } from "kafkajs";
import { MongoClient } from "mongodb";
import { KafkaContainer, type StartedKafkaContainer } from "@testcontainers/kafka";
import { MongoDBContainer, type StartedMongoDBContainer } from "@testcontainers/mongodb";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { defaultPorts, type ServiceName } from "@commerce-flow/config";
import { Topics } from "@commerce-flow/events";
import { databaseForService } from "@commerce-flow/mongodb";
import { createTestEnv } from "@commerce-flow/test-utils";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

const topicNames = Object.values(Topics);

function ensureDockerHost(): void {
  if (process.env["DOCKER_HOST"] !== undefined && process.env["DOCKER_HOST"] !== "") {
    return;
  }
  const colima = path.join(os.homedir(), ".colima", "default", "docker.sock");
  if (existsSync(colima)) {
    process.env["DOCKER_HOST"] = `unix://${colima}`;
    if (
      process.env["TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE"] === undefined ||
      process.env["TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE"] === ""
    ) {
      process.env["TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE"] = "/var/run/docker.sock";
    }
  }
}

export interface RunningStack {
  mongoUri: string;
  redisUrl: string;
  brokers: string;
  apps: NestFastifyApplication[];
  payment: NestFastifyApplication;
  stop(): Promise<void>;
}

export async function startStack(): Promise<RunningStack> {
  ensureDockerHost();
  const services: ServiceName[] = [
    "identity-service",
    "catalog-service",
    "inventory-service",
    "order-service",
    "payment-service",
    "api-gateway",
  ];
  await assertPortsFree(services.map((service) => defaultPorts[service]));
  const mongo = await new MongoDBContainer("mongo:8.0").start();
  const redis = await new RedisContainer("redis:8-alpine").start();
  const kafka = await new KafkaContainer("confluentinc/cp-kafka:7.7.1").withKraft().start();
  try {
    const mongoUri = replicaSetUri(mongo);
    await waitForPrimary(mongoUri);
    const redisUrl = redis.getConnectionUrl();
    const brokers = `${kafka.getHost()}:${kafka.getMappedPort(9093)}`;
    await createTopics(brokers);
    const keys = await writeKeys();
    const apps: NestFastifyApplication[] = [];
    let payment: NestFastifyApplication | undefined;
    try {
      for (const service of services) {
        applyEnv(service, mongoUri, redisUrl, brokers, keys);
        const app = await startService(service);
        apps.push(app);
        if (service === "payment-service") {
          payment = app;
        }
      }
    } catch (error) {
      await stopApps(apps);
      throw error;
    }
    if (payment === undefined) {
      await stopApps(apps);
      throw new Error("payment service did not start");
    }
    return {
      mongoUri,
      redisUrl,
      brokers,
      apps,
      payment,
      async stop() {
        await stopApps(apps);
        await stopContainers(mongo, redis, kafka);
      },
    };
  } catch (error) {
    await stopContainers(mongo, redis, kafka);
    throw error;
  }
}

async function startService(service: ServiceName): Promise<NestFastifyApplication> {
  switch (service) {
    case "identity-service":
      return (await import("../../apps/identity-service/src/bootstrap/server.js")).bootstrap();
    case "catalog-service":
      return (await import("../../apps/catalog-service/src/bootstrap/server.js")).bootstrap();
    case "inventory-service":
      return (await import("../../apps/inventory-service/src/bootstrap/server.js")).bootstrap();
    case "order-service":
      return (await import("../../apps/order-service/src/bootstrap/server.js")).bootstrap();
    case "payment-service":
      return (await import("../../apps/payment-service/src/bootstrap/server.js")).bootstrap();
    case "api-gateway":
      return (await import("../../apps/api-gateway/src/bootstrap/server.js")).bootstrap();
    default:
      throw new Error(`No e2e bootstrap for ${service}`);
  }
}

function applyEnv(
  service: ServiceName,
  mongoUri: string,
  redisUrl: string,
  brokers: string,
  keys: { privateKey: string; publicKey: string },
): void {
  const env = createTestEnv({
    SERVICE_NAME: service,
    PORT: String(defaultPorts[service]),
    MONGO_URI: mongoUri,
    MONGO_DATABASE: databaseForService(service) ?? "unused",
    REDIS_URL: redisUrl,
    KAFKA_BROKERS: brokers,
    KAFKA_CLIENT_ID: `${service}-e2e`,
    KAFKA_GROUP_ID: `${service}-e2e`,
    JWT_PRIVATE_KEY_PATH: keys.privateKey,
    JWT_PUBLIC_KEY_PATH: keys.publicKey,
    LOG_LEVEL: "error",
    GATEWAY_UPSTREAM_HOST: "http://127.0.0.1",
  });
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
  delete process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
  delete process.env["PAYMENT_FAILURE_MODE"];
}

function replicaSetUri(container: StartedMongoDBContainer): string {
  const member = `${container.getHost()}:${container.getMappedPort(27017)}`;
  return `mongodb://${member}/?replicaSet=rs0&directConnection=true`;
}

async function waitForPrimary(uri: string): Promise<void> {
  const started = Date.now();
  let last = "replica set did not answer";
  while (Date.now() - started < 30_000) {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 2_000 });
    try {
      await client.connect();
      await client.db("admin").command({ ping: 1 });
      return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
      await delay(500);
    } finally {
      await client.close().catch(() => undefined);
    }
  }
  throw new Error(`replica set was not ready: ${last}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function createTopics(brokers: string): Promise<void> {
  const kafka = new Kafka({
    clientId: "e2e-admin",
    brokers: [brokers],
    connectionTimeout: 15_000,
  });
  const admin = kafka.admin();
  await admin.connect();
  try {
    await admin.createTopics({
      waitForLeaders: true,
      topics: topicNames.map((topic) => ({ topic, numPartitions: 1, replicationFactor: 1 })),
    });
  } finally {
    await admin.disconnect();
  }
}

async function writeKeys(): Promise<{ privateKey: string; publicKey: string }> {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const directory = path.join(os.tmpdir(), `commerce-flow-e2e-${Date.now()}`);
  await mkdir(directory, { recursive: true });
  const privateKey = path.join(directory, "private.pem");
  const publicKey = path.join(directory, "public.pem");
  await writeFile(privateKey, pair.privateKey.export({ type: "pkcs8", format: "pem" }));
  await writeFile(publicKey, pair.publicKey.export({ type: "spki", format: "pem" }));
  return { privateKey, publicKey };
}

async function assertPortsFree(ports: readonly number[]): Promise<void> {
  for (const port of ports) {
    if (!(await portFree(port))) {
      throw new Error(
        `Port ${port} is in use. Stop the local Commerce Flow processes before the e2e suite.`,
      );
    }
  }
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function stopApps(apps: readonly NestFastifyApplication[]): Promise<void> {
  for (const app of [...apps].reverse()) {
    await app.close();
  }
}

async function stopContainers(
  mongo: StartedMongoDBContainer,
  redis: StartedRedisContainer,
  kafka: StartedKafkaContainer,
): Promise<void> {
  await kafka.stop();
  await redis.stop();
  await mongo.stop();
}
