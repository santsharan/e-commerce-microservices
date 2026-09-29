import { spawn, type ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";
import { defaultPorts, serviceNames, type ServiceName } from "@commerce-flow/config";
import { databaseForService } from "@commerce-flow/mongodb";
import { infraTargets } from "./infra-plan.js";

function childEnv(serviceName: ServiceName, inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const targets = infraTargets(inherited);
  const database = databaseForService(serviceName) ?? "unused";
  return {
    ...inherited,
    NODE_ENV: inherited["NODE_ENV"] ?? "development",
    LOG_LEVEL: inherited["LOG_LEVEL"] ?? "info",
    SERVICE_NAME: serviceName,
    PORT: String(defaultPorts[serviceName]),
    MONGO_URI: targets.mongoUri,
    MONGO_DATABASE: database,
    REDIS_URL: targets.redisUrl,
    KAFKA_BROKERS: targets.kafkaBrokers.join(","),
    KAFKA_CLIENT_ID: serviceName,
    KAFKA_GROUP_ID: `${serviceName}-group`,
    JWT_ISSUER: inherited["JWT_ISSUER"] ?? "commerce-identity",
    JWT_AUDIENCE: inherited["JWT_AUDIENCE"] ?? "commerce-api",
    OTEL_EXPORTER_OTLP_ENDPOINT:
      inherited["OTEL_EXPORTER_OTLP_ENDPOINT"] ?? "http://127.0.0.1:4318",
  };
}

export function startDevServices(inherited: NodeJS.ProcessEnv = process.env): ChildProcess[] {
  return serviceNames.map((serviceName) => {
    const child = spawn("node", [`apps/${serviceName}/dist/main.js`], {
      env: childEnv(serviceName, inherited),
      stdio: "inherit",
    });
    child.on("exit", (code, signal) => {
      if (signal === null && code !== 0 && code !== null) {
        process.stderr.write(`${serviceName} exited with code ${code}\n`);
      }
    });
    return child;
  });
}

function stopAll(children: readonly ChildProcess[]): void {
  for (const child of children) {
    child.kill("SIGTERM");
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const children = startDevServices();
  process.stdout.write("started service skeletons against local infrastructure\n");
  const stop = (): void => {
    stopAll(children);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
