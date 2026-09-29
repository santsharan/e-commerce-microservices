import { Kafka, logLevel } from "kafkajs";
import { MongoClient } from "mongodb";
import { createClient } from "redis";
import {
  localInfraDefaults,
  serviceDatabases,
  topicNames,
  type InfraTargets,
} from "./infra-plan.js";

const markerPurpose = "empty-database-marker";

async function withMongo<T>(uri: string, run: (client: MongoClient) => Promise<T>): Promise<T> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5_000 });
  try {
    await client.connect();
    return await run(client);
  } finally {
    await client.close();
  }
}

async function withRedis<T>(
  url: string,
  run: (client: {
    ping: () => Promise<string>;
    flushAll: () => Promise<string>;
    isOpen: boolean;
  }) => Promise<T>,
): Promise<T> {
  const client = createClient({ url });
  client.on("error", () => {
    // connect() rejects with the same failure. This avoids an unhandled error event.
  });
  try {
    await client.connect();
    return await run(client);
  } finally {
    if (client.isOpen) {
      await client.quit();
    }
  }
}

async function withKafkaAdmin<T>(
  brokers: readonly string[],
  run: (admin: ReturnType<Kafka["admin"]>) => Promise<T>,
): Promise<T> {
  const kafka = new Kafka({
    clientId: "commerce-infra",
    brokers: [...brokers],
    logLevel: logLevel.NOTHING,
    connectionTimeout: 5_000,
  });
  const admin = kafka.admin();
  await admin.connect();
  try {
    return await run(admin);
  } finally {
    await admin.disconnect();
  }
}

export async function assertMongoPrimary(uri: string): Promise<void> {
  await withMongo(uri, async (client) => {
    const hello = await client.db("admin").command({ hello: 1 });
    if (hello["isWritablePrimary"] !== true) {
      throw new Error("MongoDB replica set has no primary yet");
    }
  });
}

export async function assertRedisReady(url: string): Promise<void> {
  await withRedis(url, async (client) => {
    const pong = await client.ping();
    if (pong !== "PONG") {
      throw new Error("Redis did not respond to PING");
    }
  });
}

export async function assertKafkaReady(brokers: readonly string[]): Promise<void> {
  await withKafkaAdmin(brokers, async (admin) => {
    await admin.listTopics();
  });
}

export async function ensurePlatformState(targets: InfraTargets): Promise<void> {
  await withMongo(targets.mongoUri, async (client) => {
    for (const database of serviceDatabases()) {
      await client
        .db(database)
        .collection(localInfraDefaults.platformCollection)
        .updateOne(
          { purpose: markerPurpose },
          {
            $set: {
              purpose: markerPurpose,
              seededAt: new Date().toISOString(),
            },
          },
          { upsert: true },
        );
    }
  });

  await withKafkaAdmin(targets.kafkaBrokers, async (admin) => {
    await admin.createTopics({
      waitForLeaders: true,
      topics: topicNames().map((topic) => ({
        topic,
        numPartitions: localInfraDefaults.topicPartitions,
        replicationFactor: 1,
      })),
    });
  });
}

export async function resetPlatformState(targets: InfraTargets): Promise<void> {
  await withMongo(targets.mongoUri, async (client) => {
    for (const database of serviceDatabases()) {
      await client.db(database).dropDatabase();
    }
  });

  await withRedis(targets.redisUrl, async (client) => {
    await client.flushAll();
  });

  await withKafkaAdmin(targets.kafkaBrokers, async (admin) => {
    const existing = new Set(await admin.listTopics());
    const topics = topicNames().filter((topic) => existing.has(topic));
    if (topics.length > 0) {
      await admin.deleteTopics({ topics });
    }
  });

  await ensurePlatformState(targets);
}
