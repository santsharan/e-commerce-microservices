import { AppError } from "@commerce-flow/errors";
import { bootstrap } from "./bootstrap/server.js";

function detailNames(error: AppError): string[] {
  const names: string[] = [];
  for (const key of ["fields", "dependencies"]) {
    const value = error.details[key];
    if (!Array.isArray(value)) {
      continue;
    }
    for (const item of value) {
      if (typeof item === "string") {
        names.push(item);
      }
    }
  }
  const dependency = error.details["dependency"];
  if (typeof dependency === "string") {
    names.push(dependency);
  }
  return names;
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Service failed to start";
  const names = error instanceof AppError ? detailNames(error) : [];
  const suffix = names.length === 0 ? "" : `: ${names.join(", ")}`;
  process.stderr.write(`fatal: ${message}${suffix}\n`);
  process.exit(1);
});
