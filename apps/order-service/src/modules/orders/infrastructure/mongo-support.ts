import { AppError, ErrorCode } from "@commerce-flow/errors";
import type { MongoHandle } from "@commerce-flow/mongodb";
import type { ResourceRegistry } from "../../../bootstrap/resources.js";

export function requireMongo(registry: ResourceRegistry): MongoHandle {
  const mongo = registry.opened()?.mongo;
  if (mongo === undefined) {
    throw new AppError(
      ErrorCode.DEPENDENCY_UNAVAILABLE,
      "A required dependency is unavailable",
      503,
      { dependency: "mongodb" },
    );
  }
  return mongo;
}

export function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

export async function runOrderTransaction<T>(
  registry: ResourceRegistry,
  work: (session: object) => Promise<T>,
): Promise<T> {
  return requireMongo(registry).withTransaction((session) => work(session));
}

export function sessionOptions(session: object | undefined): { session: never } | undefined {
  if (session === undefined) {
    return undefined;
  }
  return { session: session as never };
}
