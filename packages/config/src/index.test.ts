import { AppError } from "@commerce-flow/errors";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./index.js";

function validEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    SERVICE_NAME: "order-service",
    LOG_LEVEL: "silent",
    MONGO_URI: "mongodb://localhost:27017/?replicaSet=rs0",
    MONGO_DATABASE: "order-db",
    REDIS_URL: "redis://localhost:6379",
    KAFKA_BROKERS: "localhost:9092, localhost:9093",
    KAFKA_CLIENT_ID: "order-service",
    KAFKA_GROUP_ID: "order-service-group",
    JWT_ISSUER: "commerce-identity",
    JWT_AUDIENCE: "commerce-api",
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  return env;
}

describe("loadConfig", () => {
  it("loads a typed config and applies the service port", () => {
    const config = loadConfig(validEnv());

    expect(config.serviceName).toBe("order-service");
    expect(config.port).toBe(3004);
    expect(config.kafka.brokers).toEqual(["localhost:9092", "localhost:9093"]);
    expect(config.mongodb.database).toBe("order-db");
    expect(config.auth.privateKeyPath).toBeUndefined();
  });

  it("fails fast when a required value is missing and names the field only", () => {
    try {
      loadConfig(validEnv({ KAFKA_BROKERS: undefined }));
      expect.fail("expected configuration to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        code: "CONFIG_INVALID",
        details: { fields: ["KAFKA_BROKERS"] },
      });
    }
  });

  it("does not echo credentials when redis is misconfigured", () => {
    const secret = "redis-password-do-not-leak";
    try {
      loadConfig(validEnv({ REDIS_URL: `http://default:${secret}@localhost:6379` }));
      expect.fail("expected configuration to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(String(error)).not.toContain(secret);
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });

  it("rejects an out-of-range port", () => {
    expect(() => loadConfig(validEnv({ PORT: "70000" }))).toThrow(AppError);
  });

  it("derives gateway upstreams from the shared host and accepts one override", () => {
    const defaults = loadConfig(validEnv());
    expect(defaults.gateway.upstreams).toEqual({
      identity: "http://127.0.0.1:3001",
      catalog: "http://127.0.0.1:3002",
      inventory: "http://127.0.0.1:3003",
      order: "http://127.0.0.1:3004",
    });

    const overridden = loadConfig(validEnv({ GATEWAY_ORDER_URL: "http://order-service:3004/" }));
    expect(overridden.gateway.upstreams.order).toBe("http://order-service:3004");
    expect(overridden.gateway.upstreams.identity).toBe("http://127.0.0.1:3001");
  });
});
