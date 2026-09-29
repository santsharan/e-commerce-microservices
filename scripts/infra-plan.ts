import { Topics } from "@commerce-flow/events";
import { ServiceDatabase } from "@commerce-flow/mongodb";

/** Host-side defaults. The replica set member is 127.0.0.1, not localhost. */
export const localInfraDefaults = {
  mongoUri: "mongodb://127.0.0.1:27017/?replicaSet=rs0",
  redisUrl: "redis://127.0.0.1:6379",
  kafkaBrokers: "localhost:9092",
  topicPartitions: 3,
  platformCollection: "_platform",
  replicaSetMemberHost: "127.0.0.1:27017",
} as const;

export const infraHttpChecks = [
  { name: "kafka-ui", url: "http://127.0.0.1:8080/" },
  { name: "prometheus", url: "http://127.0.0.1:9090/-/ready" },
  { name: "grafana", url: "http://127.0.0.1:3007/api/health" },
  { name: "jaeger", url: "http://127.0.0.1:16686/" },
  { name: "loki", url: "http://127.0.0.1:3100/ready" },
  { name: "otel-collector", url: "http://127.0.0.1:13133/" },
] as const;

export function serviceDatabases(): readonly string[] {
  return Object.values(ServiceDatabase);
}

export function topicNames(): readonly string[] {
  return Object.values(Topics);
}

export interface InfraTargets {
  mongoUri: string;
  redisUrl: string;
  kafkaBrokers: string[];
}

export function infraTargets(env: NodeJS.ProcessEnv = process.env): InfraTargets {
  const brokers = (env["KAFKA_BROKERS"] ?? localInfraDefaults.kafkaBrokers)
    .split(",")
    .map((broker) => broker.trim())
    .filter((broker) => broker.length > 0);
  if (brokers.length === 0) {
    throw new Error("KAFKA_BROKERS must list at least one broker");
  }
  return {
    mongoUri: env["MONGO_URI"] ?? localInfraDefaults.mongoUri,
    redisUrl: env["REDIS_URL"] ?? localInfraDefaults.redisUrl,
    kafkaBrokers: brokers,
  };
}

export function resetIsConfirmed(argv: readonly string[]): boolean {
  return argv.includes("--yes");
}

export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "failed";
  return message.replace(/\/\/[^@\s/]+@/g, "//");
}

export interface Probe {
  name: string;
  run: () => Promise<void>;
}

export async function collectProbeFailures(probes: readonly Probe[]): Promise<string[]> {
  const results = await Promise.all(
    probes.map(async (probe) => {
      try {
        await probe.run();
        return null;
      } catch (error) {
        return `${probe.name}: ${safeErrorMessage(error)}`;
      }
    }),
  );
  return results.filter((result): result is string => result !== null);
}

export async function waitForProbes(
  probes: readonly Probe[],
  options: { timeoutMs: number; intervalMs: number },
): Promise<void> {
  const started = Date.now();
  let failures: string[];
  do {
    failures = await collectProbeFailures(probes);
    if (failures.length === 0) {
      return;
    }
    if (Date.now() - started >= options.timeoutMs) {
      break;
    }
    await delay(options.intervalMs);
  } while (Date.now() - started <= options.timeoutMs);

  throw new Error(`Infrastructure is not ready:\n${failures.join("\n")}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function topicsDeclaredIn(script: string): string[] {
  return script
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("commerce."));
}
