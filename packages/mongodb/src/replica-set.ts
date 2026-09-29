import { AppError, ErrorCode } from "@commerce-flow/errors";

function configError(message: string, details: Record<string, unknown>): AppError {
  return new AppError(ErrorCode.CONFIG_INVALID, message, 500, details);
}

/**
 * Transactions need a replica set. `mongodb+srv` URIs are accepted because Atlas
 * SRV records already point at a replica set.
 */
export function assertReplicaSetUri(uri: string): void {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw configError("MONGO_URI is not a valid URL", { fields: ["MONGO_URI"] });
  }

  const isSrv = parsed.protocol === "mongodb+srv:";
  const replicaSet = parsed.searchParams.get("replicaSet");
  if (!isSrv && (replicaSet === null || replicaSet.length === 0)) {
    throw configError("MONGO_URI must target a replica set", { fields: ["MONGO_URI"] });
  }
}
