import { databaseForService } from "@commerce-flow/mongodb";

/**
 * Builds a complete environment for tests and local skeleton boots.
 * Services that own data receive their own database name.
 */
export function createTestEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const serviceName = overrides["SERVICE_NAME"] ?? "api-gateway";
  const ownedDatabase = databaseForService(serviceName);
  return {
    NODE_ENV: "test",
    SERVICE_NAME: serviceName,
    LOG_LEVEL: "silent",
    MONGO_URI: "mongodb://localhost:27017/?replicaSet=rs0",
    MONGO_DATABASE: ownedDatabase ?? "unused",
    REDIS_URL: "redis://localhost:6379",
    KAFKA_BROKERS: "localhost:9092",
    KAFKA_CLIENT_ID: serviceName,
    KAFKA_GROUP_ID: `${serviceName}-group`,
    JWT_ISSUER: "commerce-identity",
    JWT_AUDIENCE: "commerce-api",
    ...overrides,
  };
}
