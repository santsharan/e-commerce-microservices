import { AppError, ErrorCode } from "@commerce-flow/errors";
import { z } from "zod";

export const serviceNames = [
  "api-gateway",
  "identity-service",
  "catalog-service",
  "inventory-service",
  "order-service",
  "payment-service",
  "notification-service",
] as const;

export type ServiceName = (typeof serviceNames)[number];

export const defaultPorts: Record<ServiceName, number> = {
  "api-gateway": 3000,
  "identity-service": 3001,
  "catalog-service": 3002,
  "inventory-service": 3003,
  "order-service": 3004,
  "payment-service": 3005,
  "notification-service": 3006,
};

const logLevels = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type LogLevel = (typeof logLevels)[number];

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  serviceName: ServiceName;
  port: number;
  logLevel: LogLevel;
  mongodb: {
    uri: string;
    database: string;
  };
  kafka: {
    brokers: string[];
    clientId: string;
    groupId: string;
  };
  redis: {
    url: string;
  };
  auth: {
    issuer: string;
    audience: string;
    privateKeyPath?: string;
    publicKeyPath?: string;
  };
  observability: {
    serviceName: string;
    otlpEndpoint?: string;
  };
  gateway: {
    upstreamHost: string;
    corsOrigins: readonly string[];
    upstreams: {
      identity: string;
      catalog: string;
      inventory: string;
      order: string;
    };
  };
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z
    .string()
    .regex(/^[0-9]+$/)
    .optional(),
  SERVICE_NAME: z.enum(serviceNames),
  LOG_LEVEL: z.enum(logLevels).default("info"),
  MONGO_URI: z.string().trim().min(1),
  MONGO_DATABASE: z.string().trim().min(1),
  REDIS_URL: z.string().trim().min(1),
  KAFKA_BROKERS: z.string().trim().min(1),
  KAFKA_CLIENT_ID: z.string().trim().min(1),
  KAFKA_GROUP_ID: z.string().trim().min(1),
  JWT_ISSUER: z.string().trim().min(1),
  JWT_AUDIENCE: z.string().trim().min(1),
  JWT_PRIVATE_KEY_PATH: z.string().trim().min(1).optional(),
  JWT_PUBLIC_KEY_PATH: z.string().trim().min(1).optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().trim().min(1).optional(),
  CORS_ORIGINS: z.string().trim().optional(),
  GATEWAY_UPSTREAM_HOST: z.string().trim().min(1).optional(),
  GATEWAY_IDENTITY_URL: z.string().trim().min(1).optional(),
  GATEWAY_CATALOG_URL: z.string().trim().min(1).optional(),
  GATEWAY_INVENTORY_URL: z.string().trim().min(1).optional(),
  GATEWAY_ORDER_URL: z.string().trim().min(1).optional(),
});

function configError(message: string, fields: string[]): AppError {
  return new AppError(ErrorCode.CONFIG_INVALID, message, 500, { fields });
}

function formatZodError(error: z.ZodError): AppError {
  const fields = [...new Set(error.issues.map((issue) => issue.path.join(".") || "configuration"))];
  return configError("Invalid configuration", fields);
}

function assertRedisUrl(url: string): void {
  if (!url.startsWith("redis://") && !url.startsWith("rediss://")) {
    throw configError("REDIS_URL must use the redis:// or rediss:// scheme", ["REDIS_URL"]);
  }
}

function assertHttpUrl(value: string, field: string): void {
  if (!value.startsWith("http://") && !value.startsWith("https://")) {
    throw configError(`${field} must be an http(s) URL`, [field]);
  }
}

function serviceUrl(override: string | undefined, fallback: string, field: string): string {
  const value = (override ?? fallback).replace(/\/$/, "");
  assertHttpUrl(value, field);
  return value;
}

/**
 * Loads and validates process configuration.
 * Missing or invalid configuration throws. Connection strings are not copied into the error.
 */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw formatZodError(parsed.error);
  }

  const values = parsed.data;
  assertRedisUrl(values.REDIS_URL);
  if (values.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined) {
    assertHttpUrl(values.OTEL_EXPORTER_OTLP_ENDPOINT, "OTEL_EXPORTER_OTLP_ENDPOINT");
  }
  const upstreamHost = (values.GATEWAY_UPSTREAM_HOST ?? "http://127.0.0.1").replace(/\/$/, "");
  assertHttpUrl(upstreamHost, "GATEWAY_UPSTREAM_HOST");
  const upstreams = {
    identity: serviceUrl(
      values.GATEWAY_IDENTITY_URL,
      `${upstreamHost}:${defaultPorts["identity-service"]}`,
      "GATEWAY_IDENTITY_URL",
    ),
    catalog: serviceUrl(
      values.GATEWAY_CATALOG_URL,
      `${upstreamHost}:${defaultPorts["catalog-service"]}`,
      "GATEWAY_CATALOG_URL",
    ),
    inventory: serviceUrl(
      values.GATEWAY_INVENTORY_URL,
      `${upstreamHost}:${defaultPorts["inventory-service"]}`,
      "GATEWAY_INVENTORY_URL",
    ),
    order: serviceUrl(
      values.GATEWAY_ORDER_URL,
      `${upstreamHost}:${defaultPorts["order-service"]}`,
      "GATEWAY_ORDER_URL",
    ),
  };

  const port =
    values.PORT === undefined
      ? defaultPorts[values.SERVICE_NAME]
      : Number.parseInt(values.PORT, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw configError("PORT must be an integer between 1 and 65535", ["PORT"]);
  }

  const brokers = values.KAFKA_BROKERS.split(",")
    .map((broker) => broker.trim())
    .filter((broker) => broker.length > 0);
  if (brokers.length === 0) {
    throw configError("KAFKA_BROKERS must list at least one broker", ["KAFKA_BROKERS"]);
  }

  const auth: AppConfig["auth"] = {
    issuer: values.JWT_ISSUER,
    audience: values.JWT_AUDIENCE,
  };
  if (values.JWT_PRIVATE_KEY_PATH !== undefined) {
    auth.privateKeyPath = values.JWT_PRIVATE_KEY_PATH;
  }
  if (values.JWT_PUBLIC_KEY_PATH !== undefined) {
    auth.publicKeyPath = values.JWT_PUBLIC_KEY_PATH;
  }

  const observability: AppConfig["observability"] = {
    serviceName: values.SERVICE_NAME,
  };
  if (values.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined) {
    observability.otlpEndpoint = values.OTEL_EXPORTER_OTLP_ENDPOINT;
  }

  return {
    nodeEnv: values.NODE_ENV,
    serviceName: values.SERVICE_NAME,
    port,
    logLevel: values.LOG_LEVEL,
    mongodb: {
      uri: values.MONGO_URI,
      database: values.MONGO_DATABASE,
    },
    kafka: {
      brokers,
      clientId: values.KAFKA_CLIENT_ID,
      groupId: values.KAFKA_GROUP_ID,
    },
    redis: {
      url: values.REDIS_URL,
    },
    auth,
    observability,
    gateway: {
      upstreamHost,
      corsOrigins: corsOrigins(values.CORS_ORIGINS),
      upstreams,
    },
  };
}

function corsOrigins(value: string | undefined): string[] {
  if (value === undefined || value.trim().length === 0) {
    return [];
  }
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
