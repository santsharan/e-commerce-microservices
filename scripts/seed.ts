import { pathToFileURL } from "node:url";
import { infraTargets } from "./infra-plan.js";
import { ensurePlatformState } from "./platform-state.js";

export async function seed(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await ensurePlatformState(infraTargets(env));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seed()
    .then(() => {
      process.stdout.write("seeded empty service databases and kafka topics\n");
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "seed failed";
      process.stderr.write(`${message}\n`);
      process.exit(1);
    });
}
