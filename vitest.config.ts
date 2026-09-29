import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

const packageNames = [
  "auth",
  "config",
  "contracts",
  "errors",
  "events",
  "kafka",
  "logger",
  "mongodb",
  "observability",
  "outbox",
  "redis",
  "test-utils",
] as const;

const alias = Object.fromEntries(
  packageNames.map((name) => [
    `@commerce-flow/${name}`,
    path.join(root, "packages", name, "src", "index.ts"),
  ]),
);

export default defineConfig({
  resolve: {
    alias,
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/*/src/**/*.spec.ts",
      "scripts/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    passWithNoTests: false,
    fileParallelism: true,
    pool: "forks",
  },
});
