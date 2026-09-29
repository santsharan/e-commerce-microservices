import { pathToFileURL } from "node:url";
import { infraTargets, resetIsConfirmed } from "./infra-plan.js";
import { resetPlatformState } from "./platform-state.js";

export async function reset(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!resetIsConfirmed(argv)) {
    throw new Error("Refusing to reset infrastructure without --yes");
  }
  await resetPlatformState(infraTargets(env));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reset(process.argv)
    .then(() => {
      process.stdout.write("reset service databases, redis, and kafka topics\n");
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "reset failed";
      process.stderr.write(`${message}\n`);
      process.exit(1);
    });
}
