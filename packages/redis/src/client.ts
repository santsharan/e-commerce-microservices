import { AppError, ErrorCode, redactCredentials } from "@commerce-flow/errors";
import { createClient } from "redis";

/** Startup should fail in seconds rather than retrying a down local Redis. */
const connectTimeoutMs = 5_000;

export interface DriverLogger {
  error(fields: { event: string; dependency: string; message: string }): void;
}

export interface RedisConnectOptions {
  url: string;
  logger?: DriverLogger;
  connectTimeoutMs?: number;
}

export interface RedisHandle {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(keys: readonly string[]): Promise<void>;
  addMember(key: string, member: string): Promise<void>;
  members(key: string): Promise<string[]>;
  increment(key: string, ttlSeconds: number): Promise<number>;
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
    { dependency: "redis" },
  );
}

export async function connectRedis(options: RedisConnectOptions): Promise<RedisHandle> {
  const client = createClient({
    url: options.url,
    socket: {
      connectTimeout: options.connectTimeoutMs ?? connectTimeoutMs,
      reconnectStrategy: () => new Error("reconnect disabled"),
    },
  });
  client.on("error", (error: unknown) => {
    options.logger?.error({
      event: "dependency.unavailable",
      dependency: "redis",
      message: driverMessage(error),
    });
  });

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    if (client.isOpen) {
      await client.quit();
    }
  };

  try {
    await client.connect();
    await client.ping();
  } catch (error) {
    options.logger?.error({
      event: "dependency.unavailable",
      dependency: "redis",
      message: driverMessage(error),
    });
    await close().catch(() => undefined);
    throw unavailable();
  }

  return {
    async get(key: string): Promise<string | null> {
      return client.get(key);
    },
    async set(key: string, value: string, ttlSeconds: number): Promise<void> {
      await client.set(key, value, { EX: ttlSeconds });
    },
    async del(keys: readonly string[]): Promise<void> {
      if (keys.length === 0) {
        return;
      }
      await client.del([...keys]);
    },
    async addMember(key: string, member: string): Promise<void> {
      await client.sAdd(key, member);
    },
    async members(key: string): Promise<string[]> {
      return client.sMembers(key);
    },
    async increment(key: string, ttlSeconds: number): Promise<number> {
      const count = await client.incr(key);
      if (count === 1) {
        await client.expire(key, ttlSeconds);
      }
      return count;
    },
    async ping(): Promise<void> {
      const reply = await client.ping();
      if (reply !== "PONG") {
        throw new Error("Redis ping failed");
      }
    },
    close,
  };
}
