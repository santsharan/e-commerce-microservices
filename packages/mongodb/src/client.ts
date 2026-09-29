import { AppError, ErrorCode, redactCredentials } from "@commerce-flow/errors";
import { MongoClient, type ClientSession, type Db } from "mongodb";
import { assertReplicaSetUri } from "./replica-set.js";

/** Startup should fail in seconds, not the driver default of 30s. */
const serverSelectionTimeoutMs = 5_000;

export interface DriverLogger {
  error(fields: { event: string; dependency: string; message: string }): void;
}

export interface MongoConnectOptions {
  uri: string;
  database: string;
  logger?: DriverLogger;
  serverSelectionTimeoutMs?: number;
  onCommand?: (input: { durationMs: number; commandName: string }) => void;
}

export interface MongoHandle {
  database: Db;
  ping(): Promise<void>;
  withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T>;
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
    { dependency: "mongodb" },
  );
}

/**
 * Opens the service database on a replica set.
 * The caller chooses the database name. This function does not create collections or indexes.
 */
export async function connectMongo(options: MongoConnectOptions): Promise<MongoHandle> {
  assertReplicaSetUri(options.uri);
  const client = new MongoClient(options.uri, {
    monitorCommands: options.onCommand !== undefined,
    serverSelectionTimeoutMS: options.serverSelectionTimeoutMs ?? serverSelectionTimeoutMs,
  });
  if (options.onCommand !== undefined) {
    const onCommand = options.onCommand;
    client.on("commandSucceeded", (event) => {
      onCommand({ durationMs: event.duration, commandName: event.commandName });
    });
  }
  const database = client.db(options.database);
  let closed = false;

  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    await client.close();
  };

  try {
    await client.connect();
    await database.command({ hello: 1 });
  } catch (error) {
    options.logger?.error({
      event: "dependency.unavailable",
      dependency: "mongodb",
      message: driverMessage(error),
    });
    await close().catch(() => undefined);
    throw unavailable();
  }

  return {
    database,
    async ping(): Promise<void> {
      const hello: unknown = await database.command({ hello: 1 });
      const primary =
        typeof hello === "object" &&
        hello !== null &&
        "isWritablePrimary" in hello &&
        hello.isWritablePrimary === true;
      if (!primary) {
        throw new Error("MongoDB is not the writable primary");
      }
    },
    async withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
      const session = client.startSession();
      try {
        return await session.withTransaction((current) => work(current));
      } finally {
        await session.endSession();
      }
    },
    close,
  };
}
