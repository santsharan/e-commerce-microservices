import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Topics } from "@commerce-flow/events";
import { ServiceDatabase } from "@commerce-flow/mongodb";
import { describe, expect, it } from "vitest";
import {
  collectProbeFailures,
  infraTargets,
  localInfraDefaults,
  resetIsConfirmed,
  safeErrorMessage,
  serviceDatabases,
  topicsDeclaredIn,
  waitForProbes,
} from "./infra-plan.js";

const topicScript = readFileSync(
  new URL("../infra/docker/kafka/create-topics.sh", import.meta.url),
  "utf8",
);
const replicaSetScript = readFileSync(
  new URL("../infra/docker/mongo/init-replica-set.js", import.meta.url),
  "utf8",
);
const composeFile = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
const k8sTopicScript = readFileSync(
  new URL("../infra/kubernetes/base/create-topics.sh", import.meta.url),
  "utf8",
);
const k8sMongoInit = readFileSync(
  new URL("../infra/kubernetes/base/mongo-init.js", import.meta.url),
  "utf8",
);

function readTree(directory: string): string {
  const parts: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      parts.push(readTree(full));
    } else {
      parts.push(readFileSync(full, "utf8"));
    }
  }
  return parts.join("\n");
}

describe("local infrastructure contract", () => {
  it("creates every catalog topic with three partitions", () => {
    expect(topicsDeclaredIn(topicScript).sort()).toEqual(Object.values(Topics).sort());
    expect(topicScript).toContain("--partitions");
    expect(topicScript).toContain("${TOPIC_PARTITIONS:-3}");
    expect(topicsDeclaredIn(k8sTopicScript).sort()).toEqual(topicsDeclaredIn(topicScript).sort());
  });

  it("initiates the in-cluster replica set on the pod DNS name and keeps keys out of git", () => {
    expect(k8sMongoInit).toContain("mongo-0.mongo.commerce-flow.svc.cluster.local:27017");
    expect(k8sMongoInit).toContain('_id: "rs0"');
    const manifest = readTree(fileURLToPath(new URL("../infra/kubernetes", import.meta.url)));
    expect(manifest).toContain("secretName: commerce-flow-jwt");
    expect(manifest).not.toMatch(/BEGIN (RSA |OPENSSH )?PRIVATE KEY/);
  });

  it("advertises the replica set on the host loopback", () => {
    expect(replicaSetScript).toContain(localInfraDefaults.replicaSetMemberHost);
    expect(localInfraDefaults.mongoUri).toContain("127.0.0.1:27017");
    expect(localInfraDefaults.mongoUri).toContain("replicaSet=rs0");
  });

  it("keeps grafana off the api gateway port and pins the stack", () => {
    expect(composeFile).toContain('"3007:3000"');
    expect(composeFile).toContain("mongo:8.0");
    expect(composeFile).toContain("apache/kafka:4.1.2");
    expect(composeFile).toContain("redis:8-alpine");
    expect(composeFile).toContain("kafbat/kafka-ui:v1.5.0");
    expect(composeFile).toContain("otel/opentelemetry-collector-contrib:0.153.0");
    expect(composeFile).toContain("jaegertracing/all-in-one:1.76.0");
  });

  it("seeds only the databases owned by services", () => {
    expect([...serviceDatabases()].sort()).toEqual([...Object.values(ServiceDatabase)].sort());
    expect(localInfraDefaults.platformCollection).toBe("_platform");
  });

  it("refuses an unconfirmed reset and hides credentials in probe errors", () => {
    expect(resetIsConfirmed(["node", "reset.ts"])).toBe(false);
    expect(resetIsConfirmed(["node", "reset.ts", "--yes"])).toBe(true);
    expect(safeErrorMessage(new Error("failed mongodb://user:secret@localhost"))).not.toContain(
      "secret",
    );
  });

  it("uses host defaults when the environment does not override them", () => {
    expect(infraTargets({})).toEqual({
      mongoUri: localInfraDefaults.mongoUri,
      redisUrl: localInfraDefaults.redisUrl,
      kafkaBrokers: ["localhost:9092"],
    });
  });

  it("reports a failed probe and resolves when every probe succeeds", async () => {
    const failures = await collectProbeFailures([
      { name: "mongo", run: () => Promise.reject(new Error("down")) },
      { name: "redis", run: () => Promise.resolve() },
    ]);
    expect(failures).toEqual(["mongo: down"]);

    await expect(
      waitForProbes([{ name: "redis", run: () => Promise.resolve() }], {
        timeoutMs: 20,
        intervalMs: 5,
      }),
    ).resolves.toBeUndefined();
  });
});
