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
