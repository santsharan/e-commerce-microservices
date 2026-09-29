import { pathToFileURL } from "node:url";
import { infraHttpChecks, infraTargets, waitForProbes } from "./infra-plan.js";
import { assertKafkaReady, assertMongoPrimary, assertRedisReady } from "./platform-state.js";

async function httpReady(url: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

export async function waitForLocalInfra(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const targets = infraTargets(env);
  const timeoutMs = Number.parseInt(env["INFRA_WAIT_TIMEOUT_MS"] ?? "120000", 10);
  await waitForProbes(
    [
      { name: "mongodb", run: () => assertMongoPrimary(targets.mongoUri) },
      { name: "redis", run: () => assertRedisReady(targets.redisUrl) },
      { name: "kafka", run: () => assertKafkaReady(targets.kafkaBrokers) },
      ...infraHttpChecks.map((check) => ({
        name: check.name,
        run: () => httpReady(check.url),
      })),
    ],
    {
      timeoutMs: Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120_000,
      intervalMs: 2_000,
    },
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  waitForLocalInfra()
    .then(() => {
      process.stdout.write("infrastructure is ready\n");
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "infrastructure wait failed";
      process.stderr.write(`${message}\n`);
      process.exit(1);
    });
}
