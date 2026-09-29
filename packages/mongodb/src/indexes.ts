import type { IndexSpec } from "./index.js";

/**
 * Driver input for a declared index.
 * `expireAfterSeconds: 0` expires documents at the date stored in the indexed field.
 */
export interface IndexRequest {
  collection: string;
  name: string;
  keys: Record<string, 1 | -1>;
  unique: boolean;
  expireAfterSeconds?: number;
}

/**
 * Turns the architecture index plan into driver createIndex input.
 * The service that owns the collection applies the result when it starts.
 */
export function indexRequests(specs: readonly IndexSpec[]): IndexRequest[] {
  return specs.map((spec) => {
    const request: IndexRequest = {
      collection: spec.collection,
      name: spec.name,
      keys: { ...spec.keys },
      unique: spec.unique === true,
    };
    if (spec.ttlField !== undefined) {
      request.expireAfterSeconds = 0;
    }
    return request;
  });
}
